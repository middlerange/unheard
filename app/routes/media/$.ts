import { createFileRoute } from '@tanstack/react-router';
import { serveMedia } from '@/lib/storage';

export const Route = createFileRoute('/media/$')({
  server: {
    handlers: {
      GET: ({ request, params }) => serveMedia(request, params._splat ?? ''),
      HEAD: ({ request, params }) => serveMedia(request, params._splat ?? ''),
    },
  },
});
