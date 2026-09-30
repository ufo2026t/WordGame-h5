# WordGame HTML5

经典文字 MUD《WordGame》（神镜传说背单词）的 HTML5 单机版。在浏览器中直接打开即可游玩，不需要安装或启动 Node.js。

## 快速开始

双击 `index.html`，或双击 `启动游戏.bat`。

建议使用 Chrome 或 Edge。

## 目录结构

```
index.html          入口页
favicon.ico         站点图标（取自原版 game.exe）
css/                样式
js/                 游戏脚本与离线资源包
data/               场景、词库、图片和音乐
build-pack.js       重新生成离线文本与图片包
bundle-h5.js        将 ES Module 打成可本地打开的脚本
```

重新生成离线包和脚本包：

```bash
node build-pack.js
node bundle-h5.js
```

## 许可证

[GNU General Public License v3.0](LICENSE)

## 仓库

Gitee：<https://gitee.com/ufo2026/word-game-h5>
