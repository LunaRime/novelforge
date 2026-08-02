; NovelForge 安装程序自定义脚本（electron-builder nsis.include）
;
; 依赖：NSIS 3.08+（electron-builder 缓存已替换为 3.08）
; — ManifestDPIAwareness 需 NSIS 3.08+（3.0.4.1 不支持，导致高 DPI/渲染模糊）

; 声明 DPI 感知：禁止 Windows 位图拉伸（整个界面模糊的根因），
; 安装界面按真实 DPI 渲染（Per-Monitor V2 最佳）
ManifestDPIAwareness "PerMonitorV2"

; 现代界面字体（Segoe UI 替代 MS Shell Dlg）
!define MUI_FONTNAME "Segoe UI"
!define MUI_FONTSIZE "9"
