// ABOUTME: Central registry for supported social platforms and platform metadata.
// ABOUTME: Start small with current platforms so future platform expansion is registry-driven.

export const SUPPORTED_PLATFORMS = [
  'twitter',
  'linkedin',
  'instagram',
  'facebook',
  'youtube',
  'reddit',
  'discord',
  'telegram',
] as const;

export type PlatformId = typeof SUPPORTED_PLATFORMS[number];

export interface PlatformDefinition {
  id: PlatformId;
  label: string;
  shortLabel: string;
  color: string;
  characterLimit: number;
  supportsThreads: boolean;
  supportsMedia: boolean;
  supportsMultipleAccounts: boolean;
  supportsCompanyProfiles: boolean;
  supportsAnalytics: boolean;
}

export const PLATFORM_DEFINITIONS: Record<PlatformId, PlatformDefinition> = {
  twitter: {
    id: 'twitter',
    label: 'Twitter',
    shortLabel: 'X',
    color: '#1d9bf0',
    characterLimit: 280,
    supportsThreads: true,
    supportsMedia: true,
    supportsMultipleAccounts: true,
    supportsCompanyProfiles: false,
    supportsAnalytics: false,
  },
  linkedin: {
    id: 'linkedin',
    label: 'LinkedIn',
    shortLabel: 'LinkedIn',
    color: '#0a66c2',
    characterLimit: 3000,
    supportsThreads: false,
    supportsMedia: true,
    supportsMultipleAccounts: true,
    supportsCompanyProfiles: true,
    supportsAnalytics: false,
  },
  instagram: {
    id: 'instagram',
    label: 'Instagram',
    shortLabel: 'IG',
    color: '#E4405F',
    characterLimit: 2200,
    supportsThreads: false,
    supportsMedia: true,
    supportsMultipleAccounts: true,
    supportsCompanyProfiles: true,
    supportsAnalytics: false,
  },
  facebook: {
    id: 'facebook',
    label: 'Facebook',
    shortLabel: 'FB',
    color: '#1877F2',
    characterLimit: 63206,
    supportsThreads: false,
    supportsMedia: true,
    supportsMultipleAccounts: true,
    supportsCompanyProfiles: true,
    supportsAnalytics: false,
  },
  youtube: {
    id: 'youtube',
    label: 'YouTube',
    shortLabel: 'YT',
    color: '#FF0000',
    characterLimit: 5000,
    supportsThreads: false,
    supportsMedia: true,
    supportsMultipleAccounts: true,
    supportsCompanyProfiles: true,
    supportsAnalytics: false,
  },
  reddit: {
    id: 'reddit',
    label: 'Reddit',
    shortLabel: 'Reddit',
    color: '#FF4500',
    characterLimit: 40000,
    supportsThreads: true,
    supportsMedia: true,
    supportsMultipleAccounts: true,
    supportsCompanyProfiles: false,
    supportsAnalytics: false,
  },
  discord: {
    id: 'discord',
    label: 'Discord',
    shortLabel: 'Discord',
    color: '#5865F2',
    characterLimit: 2000,
    supportsThreads: true,
    supportsMedia: true,
    supportsMultipleAccounts: true,
    supportsCompanyProfiles: false,
    supportsAnalytics: false,
  },
  telegram: {
    id: 'telegram',
    label: 'Telegram',
    shortLabel: 'TG',
    color: '#0088cc',
    characterLimit: 4096,
    supportsThreads: true,
    supportsMedia: true,
    supportsMultipleAccounts: true,
    supportsCompanyProfiles: false,
    supportsAnalytics: false,
  },
};

export function isPlatformId(value: string): value is PlatformId {
  return SUPPORTED_PLATFORMS.includes(value as PlatformId);
}

export function getPlatformDefinition(platform: PlatformId): PlatformDefinition {
  return PLATFORM_DEFINITIONS[platform];
}
