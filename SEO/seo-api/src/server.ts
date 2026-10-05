import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { UploadError } from './parsers.ts'
import { HttpError, SeoService } from './service.ts'

const MAX_BODY = 20 * 1024 * 1024

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length
    if (size > MAX_BODY) throw new HttpError(413, 'File too large (max 20 MB).')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  try {
    return JSON.parse((await readBody(req)).toString('utf8')) as Record<string, unknown>
  } catch {
    throw new HttpError(400, 'Request body must be JSON.')
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

type Handler = (req: IncomingMessage, params: string[]) => Promise<unknown> | unknown

export function createApp(service: SeoService) {
  const routes: [string, RegExp, Handler][] = [
    ['GET', /^\/api\/health$/, () => ({ ok: true })],
    ['GET', /^\/api\/ontology$/, () => service.ontology.summary()],
    ['GET', /^\/api\/datasets$/, () => service.datasets()],
    [
      'POST',
      /^\/api\/datasets$/,
      async (req) => {
        const raw = req.headers['x-file-name']
        const fileName = typeof raw === 'string' ? decodeURIComponent(raw) : 'upload.csv'
        return { items: service.uploadFile(fileName, await readBody(req)) }
      },
    ],
    ['GET', /^\/api\/datasets\/([\w-]+)\/deletion-impact$/, (_req, [id]) => service.deletionImpact(id)],
    ['DELETE', /^\/api\/datasets\/([\w-]+)$/, (_req, [id]) => service.deleteDataset(id)],
    ['GET', /^\/api\/dashboard$/, () => service.dashboard()],
    ['GET', /^\/api\/anomalies$/, () => service.anomalies()],
    ['PATCH', /^\/api\/anomalies\/([\w-]+)$/, async (req, [id]) => service.setAnomalyStatus(id, (await readJson(req)).status)],
    ['GET', /^\/api\/countermeasures$/, () => service.countermeasures()],
    [
      'PATCH',
      /^\/api\/countermeasures\/([\w-]+)$/,
      async (req, [id]) => service.setCountermeasureStatus(id, (await readJson(req)).status),
    ],
    ['GET', /^\/api\/reports\/weekly$/, () => service.weeklyReport()],
    ['GET', /^\/api\/status-history$/, (req) => service.statusHistory(new URL(req.url ?? '/', 'http://x').searchParams.get('id') ?? undefined)],
  ]

  return createServer(async (req, res) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname
    try {
      for (const [method, pattern, handler] of routes) {
        const match = pattern.exec(path)
        if (match && req.method === method) {
          send(res, 200, await handler(req, match.slice(1)))
          return
        }
      }
      send(res, 404, { error: `No route for ${req.method} ${path}` })
    } catch (err) {
      if (err instanceof HttpError) send(res, err.status, { error: err.message })
      else if (err instanceof UploadError) send(res, 400, { error: err.message })
      else {
        console.error(err)
        send(res, 500, { error: 'Internal server error.' })
      }
    }
  })
}
