// ABOUTME: Server functions for brand profile CRUD operations.
// ABOUTME: Called from route loaders and React components via TanStack Start.

import { createServerFn } from '@tanstack/react-start';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import {
  listBrandProfiles, getBrandProfile as dbGetBrandProfile,
  insertBrandProfile, updateBrandProfile as dbUpdateBrandProfile, deleteBrandProfile as dbDeleteBrandProfile,
  setDefaultBrandProfile,
  type BrandProfile,
} from '@/lib/db/queries';
import { getSession } from '@/lib/auth';

const BrandInput = z.object({
  name: z.string().min(1),
  voice: z.string().default(''),
  audience: z.string().default(''),
  writing_prompt: z.string().default(''),
  is_default: z.boolean().default(false),
});

// Helper to get teamId from session
async function getTeamId(): Promise<string> {
  const session = await getSession();
  const teamId = session.data.teamId;
  if (!teamId) {
    throw new Error('No team selected');
  }
  return teamId;
}

export const getBrands = createServerFn({ method: 'GET' })
  .handler(async (): Promise<BrandProfile[]> => {
    const teamId = await getTeamId();
    return listBrandProfiles(teamId);
  });

export const getBrand = createServerFn({ method: 'GET' })
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data }): Promise<BrandProfile | null> => {
    const teamId = await getTeamId();
    return dbGetBrandProfile(data.id, teamId);
  });

export const createBrand = createServerFn({ method: 'POST' })
  .inputValidator(BrandInput)
  .handler(async ({ data }): Promise<BrandProfile> => {
    const teamId = await getTeamId();
    const id = uuid();
    const now = Date.now();
    if (data.is_default) await setDefaultBrandProfile(id, teamId);
    await insertBrandProfile(id, teamId, data.name, data.voice, data.audience, data.writing_prompt, data.is_default, now);
    return dbGetBrandProfile(id, teamId) as Promise<BrandProfile>;
  });

export const updateBrand = createServerFn({ method: 'POST' })
  .inputValidator(BrandInput.extend({ id: z.string() }))
  .handler(async ({ data }): Promise<BrandProfile> => {
    const teamId = await getTeamId();
    const now = Date.now();
    await dbUpdateBrandProfile(data.id, teamId, data.name, data.voice, data.audience, data.writing_prompt, now);
    return dbGetBrandProfile(data.id, teamId) as Promise<BrandProfile>;
  });

export const deleteBrand = createServerFn({ method: 'POST' })
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data }) => {
    const teamId = await getTeamId();
    await dbDeleteBrandProfile(data.id, teamId);
    return { ok: true };
  });

export const setDefaultBrand = createServerFn({ method: 'POST' })
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data }) => {
    const teamId = await getTeamId();
    await setDefaultBrandProfile(data.id, teamId);
    return { ok: true };
  });
