# 生产系统 Stable 资产与双云盘灾备直链规范 (ASSET_LINKS.md)

> **版本基线**：`v2.6.0-stable-20260917`  
> **更新时间**：2026-09-17 21:15  
> **设计哲学**：由于完整灾备归档包包含 3,809 个核心文件（约 276.80 MB），远超 GitHub 推荐单文件限制。依照《开发项目默认交付标准》1.13 条，大体积资产通过云端网盘专属双大金库（Google Drive + 阿里云盘）永久双重备份留存，本文件记录唯一权威云端索引与哈希指纹。

---

## 一、 云端双灾备仓库物理锚点

### 1. 云端金库 1：Google Drive（5TB 豪华空间专属小号 · `rpgzwm@gmail.com`）
- **云端标准仓库路径**：
  ```text
  gdrive-rpgzwm:生产系统发布备份仓库/v2.6.0-stable-20260917/
  ```
- **网页端直达定位**：
  登录小号 Google Drive（5TB 空间），进入根目录下：  
  `我的云端硬盘 > 生产系统发布备份仓库 > v2.6.0-stable-20260917`

### 2. 云端金库 2：阿里云盘（官方会员专属账号 · `有意之中见惊喜`）
- **云端标准仓库路径**：
  ```text
  /我的备份/生产系统发布备份仓库/v2.6.0-stable-20260917/
  ```
- **客户端/网页端直达定位**：
  打开阿里云盘官方客户端或网页版，进入根目录下：  
  `备份盘 > 我的备份 > 生产系统发布备份仓库 > v2.6.0-stable-20260917`

### 3. 代码与版本源头：GitHub 远端仓库
- **项目仓库**：`https://github.com/zwmopen/content-production-app.git`
- **正式发布标签**：`v2.6.0-stable-20260917`
- **标签对应提交**：`ed04cbe` 与相关文档提交

---

## 二、 云端资产清单与哈希验真表

| 文件名 | 物理体积 | SHA-256 校验码 | 资产用途说明 |
| :--- | :--- | :--- | :--- |
| **`production_stable_v2.6.0_20260917.zip`** | **276.80 MB** (290,234,568 字节) | `d849b8987277a2a2b7056c9897e0903a5d38d58ee38380b231600c28c1186ffd` | **完整独立灾备总包**（含源码、双CDP技能、API技能、分发软件、启动批处理、manifest账本） |
| **`PRODUCTION_RECOVERY.md`** | ~8.5 KB | 同源码仓库一致 | **双模式灾备恢复手册**（CDP与API双轨恢复、开机重启 3 步启动 SOP 与断点自愈指引） |
| **`manifest.json`** | 1.11 KB | 同源码仓库一致 | **机器真源清单**（包含 Commit、Tag、组件版本与路径映射） |
| **`.env.example`** | 663 字节 | 同源码仓库一致 | **生产环境配置参考模板**（CDP 端口、飞书 Table Token 等） |
| **`SHA256SUMS.txt`** | 93 字节 | 同源码仓库一致 | **标准哈希指纹签名文本** |

---

## 三、 任意新环境一键拉取恢复 SOP (说人话极简指南)

若发生换电脑、系统重装或代码损坏，只需在终端执行以下命令之一，即可从双云盘大金库将完整生产线秒级拖回本地：

### 方式 1：从 Google Drive (5TB 小号) 极速拉取
```powershell
& "D:\AICode\工具开发\toolchains\rclone\rclone.exe" copy "gdrive-rpgzwm:生产系统发布备份仓库/v2.6.0-stable-20260917" "D:\AICode\Backups\production_stable_v2.6.0_20260917" -v
```

### 方式 2：从 阿里云盘 极速拉取
```powershell
$env:ALIYUNPAN_CONFIG_DIR = "D:\Program Files\aliyunpan\config"
& "D:\Program Files\aliyunpan\aliyunpan.exe" download "/我的备份/生产系统发布备份仓库/v2.6.0-stable-20260917" --saveto "D:\AICode\Backups"
```

### 解压并点火启动：
```text
1. 双击：D:\AICode\启动双机脱机生产_独立进程.bat
2. 双击：D:\AICode\启动双浏览器全自动生产守护.bat
```
