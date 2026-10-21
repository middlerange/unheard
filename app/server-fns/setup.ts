import { createServerFn } from '@tanstack/react-start';
import { getSession } from '@/lib/auth';
import { getUserById, listApiKeys, listChannels } from '@/lib/db/queries';
import { getSetupEnvironmentStatus } from '@/lib/setup';

export const getSetupStatus = createServerFn({ method: 'GET' }).handler(
  async () => {
    const session = await getSession();
    const { userId, teamId } = session.data;
    if (!userId || !teamId) throw new Error('Unauthorized');

    const [user, channels, keys] = await Promise.all([
      getUserById(userId),
      listChannels(teamId),
      listApiKeys(teamId),
    ]);
    const hasMediaBinding = Boolean(globalThis.__contentHubMediaBucket__);

    return {
      ...getSetupEnvironmentStatus(process.env, hasMediaBinding),
      connected: channels.length > 0,
      autoPublish: user?.auto_publish ?? false,
      apiKey: keys.some((key) => !key.revoked_at),
    };
  },
);
