// ABOUTME: API route for uploading media files to Cloudflare R2.
// ABOUTME: Returns file metadata (url, path, type) for use in post targets.

import { createFileRoute } from '@tanstack/react-router';
import { v4 as uuid } from 'uuid';
import path from 'path';
import { uploadFile } from '@/lib/storage';
import { getRequestTeamId } from '@/lib/auth';

export const Route = createFileRoute('/api/upload')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const teamId = await getRequestTeamId(request);
        if (teamId instanceof Response) return teamId;

        const formData = await request.formData();
        const file = formData.get('file') as File | null;

        if (!file) {
          return Response.json({ error: 'No file provided' }, { status: 400 });
        }

        const ext = path.extname(file.name) || '.jpg';
        const id = uuid();
        const key = `media/${id}${ext}`;
        const buffer = Buffer.from(await file.arrayBuffer());
        const url = await uploadFile(key, buffer, file.type);
        const type = file.type.startsWith('video/') ? 'video' : 'image';

        return Response.json({ id, filename: `${id}${ext}`, path: key, url, type });
      },
    },
  },
});
