// Public DOM, clipboard events and CDP keyboard/mouse only. No terminal/model hooks.
import { delay } from './browser.mjs'

export function terminalDriver(browser, scope = '.pod-terminal') {
  const { evaluate, call, until } = browser
  const root = `document.querySelector(${JSON.stringify(scope)})`
  const rows = `[...${root}.querySelectorAll('.xterm-rows>div')].map(el=>el.textContent).filter(text=>text.trim())`
  async function key(key, code, windowsVirtualKeyCode, modifiers = 0) {
    await call('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode, modifiers })
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode, modifiers })
    await delay(90)
  }
  async function focus() { await evaluate(`${root}.querySelector('.xterm-helper-textarea').focus()`) }
  async function paste(text) {
    await focus()
    await evaluate(`(()=>{const el=${root}.querySelector('.xterm-helper-textarea'),data=new DataTransfer();data.setData('text/plain',${JSON.stringify(text)});el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}))})()`)
    await delay(100)
  }
  async function input(text) { await focus(); await key('End', 'End', 35); await key('u', 'KeyU', 85, 2); await paste(text) }
  async function command(text) { await input(text); await key('Enter', 'Enter', 13) }
  async function selectOutput(width = 240) {
    const point = await evaluate(`(()=>{const el=${root}.querySelector('.xterm-screen'),row=${root}.querySelector('.xterm-rows>div'),r=el.getBoundingClientRect();return {x:r.x+2,y:r.y+row.getBoundingClientRect().height/2}})()`)
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 })
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x + width, y: point.y, button: 'left', buttons: 1 })
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x + width, y: point.y, button: 'left', clickCount: 1 })
    await delay(150)
  }
  async function connected() { await until(`!!${root}?.querySelector('.xterm-helper-textarea:not(:disabled)')&&!${root}.querySelector('[role=status].pod-terminal__banner,[role=status].cluster-terminal__banner')`) }
  return { key, focus, paste, input, command, selectOutput, connected, rowsExpression: rows, textExpression: `${rows}.join('\\n')`, text: () => evaluate(`${rows}.join('\\n')`) }
}
