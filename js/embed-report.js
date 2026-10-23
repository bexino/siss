// 被 bexino.github.io 内嵌时，把本站地址变化实时上报给父页。
// 父页用它把 iframe 的完整 URL 同步进自己的地址栏（#/pt?u=<encoded>），
// 保证复制父页地址在别处能打开同一个子页面。独立站点时无副作用。

const HUB_ORIGIN = 'https://bexino.github.io'

function reportToHub() {
  // 父页与本站同源不同域均可；目标父页 origin 明确，非内嵌时 postMessage 无接收方、静默失败
  if (window.parent === window) return
  window.parent.postMessage({ source: 'bexino-hub', url: location.href }, HUB_ORIGIN)
}

// 覆盖 hashchange（prompt 的路由）与 replaceState/pushState（siss 的 ?step= 同步）
window.addEventListener('hashchange', reportToHub)
for (const method of ['replaceState', 'pushState']) {
  const original = history[method].bind(history)
  history[method] = (...args) => {
    const ret = original(...args)
    reportToHub()
    return ret
  }
}
reportToHub()
