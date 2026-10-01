@echo off
chcp 65001 >nul
title 团建内容产线主脑（A/B 双线 CDP）
echo ============================================
echo  团建图文产线主脑 · AUTUMN-C 客户端直出模式
echo  实例 A = 9431 / 实例 B = 9432
echo  日志：D:\AICode\运行数据\autonomous_production.log
echo  这个窗口不要关，关了产线就停。
echo ============================================
echo.
cd /d "D:\AICode\工具开发\projects\content-production-app\scripts"
"C:\Users\z\AppData\Local\Programs\Python\Python311\python.exe" dual_browser_autonomous_producer.py
echo.
echo 主脑已退出。如需重启，重新双击本文件即可。
pause
