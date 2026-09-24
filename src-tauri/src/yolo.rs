//! YOLO 棋子/棋盘检测推理（移植自 chessboard 的 yolo.rs）
//! 模型与 onnxruntime.dll 均在运行时从资源目录加载, 不编译进二进制

pub const IMAGE_WIDTH: usize = 640;
pub const IMAGE_HEIGHT: usize = 640;
const INFERENCE_THREADS: usize = 4;
const CONFIDENCE_THRESHOLD: f32 = 0.7;
const IOU_THRESHOLD: f32 = 0.5;
/// 15 类: 小写黑方棋子 / 大写红方棋子 / '0' 为棋盘
const LABELS: [char; 15] = ['n', 'b', 'a', 'k', 'r', 'c', 'p', 'R', 'N', 'A', 'K', 'B', 'C', 'P', '0'];
/// 每类数量上限, NMS 时多余的低置信度框直接丢弃
const LIMIT: [usize; 15] = [2, 2, 2, 1, 2, 2, 5, 2, 2, 2, 1, 2, 2, 5, 1];

#[derive(Debug, Clone, Copy)]
pub struct Detection {
    pub x0: f32,
    pub x1: f32,
    pub y0: f32,
    pub y1: f32,
    pub confidence: f32,
    pub label: char,

    idx: usize,
    area: f32,
}

impl Detection {
    fn new(x: f32, y: f32, w: f32, h: f32, idx: usize, confidence: f32) -> Self {
        Self {
            x0: x - w / 2.0,
            x1: x + w / 2.0,
            y0: y - h / 2.0,
            y1: y + h / 2.0,
            area: w * h,
            idx,
            label: LABELS[idx],
            confidence,
        }
    }

    // 两个检测框的交并比
    #[inline]
    fn iou(&self, other: &Detection) -> f32 {
        let inter_width = (self.x1.min(other.x1) - self.x0.max(other.x0)).max(0.0);
        let inter_height = (self.y1.min(other.y1) - self.y0.max(other.y0)).max(0.0);
        let intersection = inter_width * inter_height;
        intersection / (self.area + other.area - intersection)
    }
}

// 非极大值抑制: 按置信度从高到低保留, 除去重叠框与超过每类上限的框
fn nms(detections: &mut Vec<Detection>) -> Vec<Detection> {
    detections.sort_unstable_by(|a, b| a.confidence.partial_cmp(&b.confidence).unwrap());
    let mut filtered_detections = Vec::with_capacity(33);
    let mut sizemap = [0; 15];
    while let Some(current) = detections.pop() {
        if sizemap[current.idx] + 1 > LIMIT[current.idx] {
            continue;
        }
        filtered_detections.push(current);
        sizemap[current.idx] += 1;
        detections.retain(|detection| current.iou(detection) < IOU_THRESHOLD);
    }
    filtered_detections
}

// ort 依赖仅在 Windows 下启用, 其他平台提供不可用的空实现保证编译通过
#[cfg(target_os = "windows")]
mod imp {
    use std::path::Path;
    use std::sync::OnceLock;

    use ndarray::{s, Array};
    use xcap::image::imageops::FilterType;
    use xcap::image::{DynamicImage, GenericImageView, ImageBuffer, Rgba};

    use super::{nms, CONFIDENCE_THRESHOLD, Detection, IMAGE_HEIGHT, IMAGE_WIDTH, INFERENCE_THREADS};

    static SESSION: OnceLock<ort::session::Session> = OnceLock::new();

    /// 初始化 ONNX Runtime(加载 dll)与模型文件; 必须在首次推理前调用一次
    pub fn init(dll_path: &Path, model_path: &Path) -> Result<(), String> {
        if SESSION.get().is_some() {
            return Ok(());
        }
        // load-dynamic: 指定 onnxruntime.dll 绝对路径, commit 时完成动态库加载
        ort::init_from(dll_path.to_string_lossy())
            .commit()
            .map_err(|e| format!("加载 onnxruntime 失败 ({}): {e}", dll_path.display()))?;

        let session = ort::session::Session::builder()
            .and_then(|b| b.with_optimization_level(ort::session::builder::GraphOptimizationLevel::Level3))
            .and_then(|b| b.with_intra_threads(INFERENCE_THREADS))
            .and_then(|b| b.with_intra_op_spinning(false))
            .and_then(|b| b.commit_from_file(model_path))
            .map_err(|e| format!("加载模型失败 ({}): {e}", model_path.display()))?;

        SESSION.set(session).map_err(|_| "模型已初始化".to_string())
    }

    /// 单帧推理, 返回检测框列表(坐标为 640x640 模型坐标)
    pub fn predict(origin_img: ImageBuffer<Rgba<u8>, Vec<u8>>) -> Result<Vec<Detection>, String> {
        let session = SESSION.get().ok_or("模型未初始化")?;

        let img =
            DynamicImage::from(origin_img).resize_exact(IMAGE_WIDTH as u32, IMAGE_HEIGHT as u32, FilterType::Triangle);
        let mut input = Array::zeros((1, 3, IMAGE_WIDTH, IMAGE_HEIGHT));
        for (x, y, pixel) in img.pixels() {
            let [r, g, b, _] = pixel.0;
            input[[0, 0, y as usize, x as usize]] = r as f32 / 255.0;
            input[[0, 1, y as usize, x as usize]] = g as f32 / 255.0;
            input[[0, 2, y as usize, x as usize]] = b as f32 / 255.0;
        }
        let outputs = session
            .run(ort::inputs!["images" => input.view()].map_err(|e| format!("构造输入失败: {e}"))?)
            .map_err(|e| format!("推理失败: {e}"))?;
        let output = outputs["output"]
            .try_extract_tensor::<f32>()
            .map_err(|e| format!("解析输出失败: {e}"))?
            .view()
            .t()
            .slice(s![.., .., 0])
            .t()
            .to_owned();

        let mut detections = output
            .rows()
            .into_iter()
            .filter_map(|row| {
                // 每行前 5 列为框坐标与目标置信度, 后 15 列为各类别概率
                let (class_id, max_prob) = (5..20)
                    .map(|idx| (idx - 5, row[idx]))
                    .max_by(|(_, a), (_, b)| a.partial_cmp(b).unwrap())
                    .unwrap();

                let conf = row[4] * max_prob;
                if conf < CONFIDENCE_THRESHOLD {
                    None
                } else {
                    Some(Detection::new(row[0], row[1], row[2], row[3], class_id, conf))
                }
            })
            .collect();

        Ok(nms(&mut detections))
    }
}

#[cfg(not(target_os = "windows"))]
mod imp {
    use std::path::Path;

    pub fn init(_dll_path: &Path, _model_path: &Path) -> Result<(), String> {
        Ok(())
    }

    pub fn predict(_origin_img: ImageBuffer<Rgba<u8>, Vec<u8>>) -> Result<Vec<Detection>, String> {
        Err("屏幕识别录制仅支持 Windows 平台".to_string())
    }
}

pub use imp::{init, predict};
