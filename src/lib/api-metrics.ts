import { prisma } from '@/lib/db';

// Тех-телеметрия ключевых API: длительность и успешность каждого запроса.
// Запись best-effort и не задерживает ответ пользователю.
export function withMetrics<A extends unknown[]>(
  path: string,
  handler: (...args: A) => Promise<Response>
): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    const t0 = Date.now();
    let res: Response;
    try {
      res = await handler(...args);
    } catch (e) {
      void record(path, Date.now() - t0, false);
      throw e;
    }
    void record(path, Date.now() - t0, res.ok);
    return res;
  };
}

async function record(path: string, ms: number, ok: boolean) {
  try {
    await prisma.apiMetric.create({ data: { path, ms, ok } });
  } catch {
    // телеметрия не критична
  }
}
