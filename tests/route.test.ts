import { describe, expect, it } from 'vitest'

import { buildClientConfig, contentTypeFor, parseRange, resolveInsidePackage } from '../src/route.js'

describe('parseRange', () => {
  it('没有 Range 头时按整份返回', () => {
    expect(parseRange(undefined, 100)).toBeNull()
    expect(parseRange('', 100)).toBeNull()
  })

  it('bytes=0- 是开放式区间（浏览器视频探路最常发的就是它）', () => {
    expect(parseRange('bytes=0-', 100)).toEqual({ start: 0, end: 99 })
  })

  it('显式闭区间', () => {
    expect(parseRange('bytes=10-19', 100)).toEqual({ start: 10, end: 19 })
  })

  it('区间右端超出总长时被夹到末尾（而不是报错）', () => {
    expect(parseRange('bytes=90-999', 100)).toEqual({ start: 90, end: 99 })
  })

  it('后缀区间取最后 N 字节', () => {
    expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 })
    expect(parseRange('bytes=-10', 4)).toEqual({ start: 0, end: 3 })
  })

  it('越界或非法区间返回 unsatisfiable（→ 416）', () => {
    expect(parseRange('bytes=100-', 100)).toBe('unsatisfiable')
    expect(parseRange('bytes=50-10', 100)).toBe('unsatisfiable')
    expect(parseRange('bytes=-0', 100)).toBe('unsatisfiable')
    expect(parseRange('bytes=', 100)).toBeNull()
  })

  it('不认识的语法退回整份返回（不猜）', () => {
    expect(parseRange('items=0-10', 100)).toBeNull()
    expect(parseRange('bytes=abc-def', 100)).toBeNull()
  })

  it('空资源一律 unsatisfiable', () => {
    expect(parseRange('bytes=0-', 0)).toBe('unsatisfiable')
  })
})

describe('contentTypeFor', () => {
  it('认识过场视频与常见类型', () => {
    expect(contentTypeFor('/x/transition.webm')).toBe('video/webm')
    expect(contentTypeFor('a.MP4')).toBe('video/mp4')
    expect(contentTypeFor('icon.svg')).toBe('image/svg+xml')
    expect(contentTypeFor('c.json')).toBe('application/json; charset=utf-8')
  })

  it('未知扩展名回落 octet-stream', () => {
    expect(contentTypeFor('weird.xyz')).toBe('application/octet-stream')
    expect(contentTypeFor('noext')).toBe('application/octet-stream')
  })
})

describe('resolveInsidePackage', () => {
  const root = process.platform === 'win32' ? 'D:\\pkg' : '/pkg'

  it('包内正常路径可解析', () => {
    const resolved = resolveInsidePackage(root, 'assets/transition.webm')
    expect(resolved.endsWith('transition.webm')).toBe(true)
  })

  it('逃出包目录的路径必须被拒绝（配置是可信输入，但不该给配置留读任意文件的口子）', () => {
    expect(() => resolveInsidePackage(root, '../../secret.txt')).toThrow(/escapes the package/u)
    expect(() => resolveInsidePackage(root, '..')).toThrow(/escapes the package/u)
  })

  it('绝对路径也被拒绝', () => {
    const absolute = process.platform === 'win32' ? 'C:\\Windows\\win.ini' : '/etc/passwd'
    expect(() => resolveInsidePackage(root, absolute)).toThrow(/escapes the package/u)
  })
})

describe('buildClientConfig', () => {
  it('把宿主配置与视频路由合成给浏览器的载荷', () => {
    const payload = buildClientConfig(
      {
        targetUrl: 'https://example.test/',
        videoSource: 'route',
        buttonLabel: '开启',
        openIn: 'same-tab',
        transition: 'video',
        muted: false,
        maxWaitMs: 1234,
      },
      '/posterflow-ai/transition.webm',
    )
    expect(payload).toEqual({
      targetUrl: 'https://example.test/',
      videoSource: 'route',
      buttonLabel: '开启',
      openIn: 'same-tab',
      transition: 'video',
      videoUrl: '/posterflow-ai/transition.webm',
      muted: false,
      maxWaitMs: 1234,
    })
  })
})
