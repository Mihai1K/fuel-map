import { NextResponse, type NextRequest } from 'next/server';

// www.tytbenzin.ru — дубль-зеркало: склеиваем 301-редиректом на основной домен
export function middleware(req: NextRequest) {
  const host = req.headers.get('host') ?? '';
  if (host.startsWith('www.')) {
    const url = req.nextUrl.clone();
    url.host = host.slice(4);
    url.port = '';
    return NextResponse.redirect(url, 301);
  }
  return NextResponse.next();
}

export const config = {
  // статику и служебные файлы не трогаем
  matcher: ['/((?!_next/|icon-|apple-touch-icon|favicon).*)'],
};
