// Exercise public keyboard, clipboard and scroll DOM behavior; no component/model test hooks.
import { delay } from './browser.mjs'

export function codeMirrorDriver(browser) {
  const { evaluate, until, call } = browser
  async function key(key, code, windowsVirtualKeyCode, modifiers = 0) {
    await call('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode, modifiers })
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode, modifiers })
    await delay(60)
  }
  async function focus(selector) {
    await until(`!!document.querySelector(${JSON.stringify(selector)})`)
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).focus({preventScroll:true})`)
    await until(`document.activeElement===document.querySelector(${JSON.stringify(selector)})`)
  }
  async function read(selector) {
    await focus(selector); await key('a', 'KeyA', 65, 2)
    return evaluate(`(()=>{const target=document.querySelector(${JSON.stringify(selector)});const data=new DataTransfer();target.dispatchEvent(new ClipboardEvent('copy',{clipboardData:data,bubbles:true,cancelable:true}));return data.getData('text/plain')})()`)
  }
  async function write(selector, text) {
    await focus(selector); await key('a', 'KeyA', 65, 2)
    await call('Input.insertText', { text }); await delay(100)
  }
  async function scroll(selector, top, left) {
    await evaluate(`(()=>{const area=document.querySelector(${JSON.stringify(selector)});area.scrollTop=${top};area.scrollLeft=${left};area.dispatchEvent(new Event('scroll'))})()`)
    await delay(250)
  }
  return { read, write, key, focus, scroll }
}
