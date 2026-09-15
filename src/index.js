
export { QuizRoom } from './QuizRoom.js';

function assetRequest(request, pathname) {
  const url = new URL(request.url);
  url.pathname = pathname;
  url.search = '';
  return new Request(url.toString(), request);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path.startsWith('/api/') || path === '/ws') {
      const id = env.QUIZ_ROOM.idFromName('quiz-sipat-2026-main');
      return env.QUIZ_ROOM.get(id).fetch(request);
    }

    if (path === '/') return env.ASSETS.fetch(assetRequest(request, '/player.html'));
    if (path === '/host' || path === '/host/') return env.ASSETS.fetch(assetRequest(request, '/host.html'));
    if (path === '/admin' || path === '/admin/') return env.ASSETS.fetch(assetRequest(request, '/admin.html'));

    return env.ASSETS.fetch(request);
  }
};
