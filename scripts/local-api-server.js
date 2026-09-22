// Local-only stand-in for Vercel's serverless runtime. Vite's dev server
// doesn't execute anything in api/, so this runs the same handler modules
// under plain Node and Vite proxies /api/* to it (see vite.config.js).
// Not used in production — Vercel runs api/*.js directly.
import http from 'http'
import { config } from 'dotenv'

config()

const PORT = process.env.LOCAL_API_PORT || 3001

const ROUTES = {
  '/api/auth': () => import('../api/auth.js'),
  '/api/logout': () => import('../api/logout.js'),
  '/api/session': () => import('../api/session.js'),
  '/api/data': () => import('../api/data.js'),
  '/api/owners': () => import('../api/owners.js'),
}

function withHelpers(res) {
  res.status = (code) => { res.statusCode = code; return res }
  res.json = (obj) => {
    if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(obj))
  }
  return res
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => { data += chunk })
    req.on('end', () => {
      if (!data) return resolve({})
      try { resolve(JSON.parse(data)) } catch (err) { reject(err) }
    })
    req.on('error', reject)
  })
}

const server = http.createServer(async (req, res) => {
  const pathname = req.url.split('?')[0]
  const loadRoute = ROUTES[pathname]
  if (!loadRoute) {
    res.statusCode = 404
    res.end('Not found')
    return
  }
  withHelpers(res)
  try {
    if (req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE') {
      req.body = await readJsonBody(req)
    }
    const mod = await loadRoute()
    await mod.default(req, res)
  } catch (err) {
    console.error(pathname, 'failed:', err)
    if (!res.headersSent) {
      res.statusCode = 500
      res.end('Internal error')
    }
  }
})

server.listen(PORT, () => {
  console.log(`Local API dev server listening on http://localhost:${PORT}`)
})
