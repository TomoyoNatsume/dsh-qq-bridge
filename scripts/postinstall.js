console.log(`
dsh-qq-bridge 已安装，但尚未配置 QQ / NapCat / DSH profile。

如果你是通过 dsh plugin --profile web add 安装的，请继续运行:
  cd ~/.dsh/profiles/web
  pnpm exec dsh-qq-bridge setup

安装本身不会自动挂载插件，也不会影响 DSH 正常启动；setup 完成后才会写入本机配置。
`)
