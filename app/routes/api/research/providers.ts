import { createFileRoute } from '@tanstack/react-router';
import { researchProvidersHttp } from '@/lib/research-providers';

export const Route = createFileRoute('/api/research/providers')({
  server: {
    handlers: { POST: ({ request }) => researchProvidersHttp(request) },
  },
});
