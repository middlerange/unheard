// ABOUTME: Platform validation utilities for content limits and media constraints.
// ABOUTME: Centralizes validation logic for all supported social media platforms.

import type { Media } from './db/types';

export interface ValidationError {
  field: string;
  message: string;
  platform: string;
}

export interface PlatformLimits {
  maxCharacters: number;
  maxMedia: number;
  maxImages: number; // For non-carousel posts
  supportsCarousel: boolean;
  maxCarouselImages: number;
  supportedMediaTypes: ('image' | 'video' | 'gif')[];
}

export const PLATFORM_LIMITS: Record<string, PlatformLimits> = {
  twitter: {
    maxCharacters: 280,
    maxMedia: 4,
    maxImages: 4, // Twitter allows up to 4 images in a single tweet
    supportsCarousel: false, // Twitter doesn't have carousel posts like LinkedIn
    maxCarouselImages: 0,
    supportedMediaTypes: ['image', 'video', 'gif'],
  },
  twitter_premium: {
    maxCharacters: 4000,
    maxMedia: 4,
    maxImages: 4,
    supportsCarousel: false,
    maxCarouselImages: 0,
    supportedMediaTypes: ['image', 'video', 'gif'],
  },
  linkedin: {
    maxCharacters: 3000,
    maxMedia: 1, // Base limit - can be extended with carousel
    maxImages: 1, // Non-carousel posts: 1 image
    supportsCarousel: true,
    maxCarouselImages: 10, // LinkedIn carousel allows up to 10 images
    supportedMediaTypes: ['image', 'video'],
  },
  instagram: {
    maxCharacters: 2200,
    maxMedia: 1,
    maxImages: 1,
    supportsCarousel: false,
    maxCarouselImages: 0,
    supportedMediaTypes: ['image', 'video'],
  },
  facebook: {
    maxCharacters: 63206,
    maxMedia: 1,
    maxImages: 1,
    supportsCarousel: false,
    maxCarouselImages: 0,
    supportedMediaTypes: ['image', 'video'],
  },
  youtube: {
    maxCharacters: 5000,
    maxMedia: 1,
    maxImages: 0,
    supportsCarousel: false,
    maxCarouselImages: 0,
    supportedMediaTypes: ['video'],
  },
  reddit: {
    maxCharacters: 40000, // Self-text posts
    maxMedia: 1, // Usually 1 image/video per post
    maxImages: 1,
    supportsCarousel: false,
    maxCarouselImages: 0,
    supportedMediaTypes: ['image', 'video', 'gif'],
  },
  discord: {
    maxCharacters: 2000, // Standard message limit (can be higher for nitro/premium)
    maxMedia: 10, // Discord allows up to 10 attachments
    maxImages: 10,
    supportsCarousel: false,
    maxCarouselImages: 0,
    supportedMediaTypes: ['image', 'video', 'gif'],
  },
  telegram: {
    maxCharacters: 4096,
    maxMedia: 1, // One media item per message typically
    maxImages: 1,
    supportsCarousel: true, // Album support
    maxCarouselImages: 10,
    supportedMediaTypes: ['image', 'video', 'gif'],
  },
};

/**
 * Get platform limits, optionally with premium status for Twitter
 */
export function getPlatformLimits(platform: string, isPremium = false): PlatformLimits {
  if (platform === 'twitter' && isPremium) {
    return PLATFORM_LIMITS.twitter_premium;
  }
  return PLATFORM_LIMITS[platform] ?? PLATFORM_LIMITS.twitter;
}

/**
 * Validate content length for a specific platform
 */
export function validateContentLength(
  content: string,
  platform: string,
  isPremium = false
): ValidationError | null {
  const limits = getPlatformLimits(platform, isPremium);
  const length = content.length;

  if (length > limits.maxCharacters) {
    return {
      field: 'content',
      platform,
      message: `${platform} posts must be ${limits.maxCharacters} characters or less. Current: ${length}`,
    };
  }
  return null;
}

/**
 * Validate thread content lengths for platforms that support threads
 * (primarily Twitter/X)
 */
export function validateThreadLengths(
  mainContent: string,
  thread: string[],
  platform: string,
  isPremium = false
): ValidationError[] {
  const errors: ValidationError[] = [];
  const limits = getPlatformLimits(platform, isPremium);
  
  // Check main content
  const mainError = validateContentLength(mainContent, platform, isPremium);
  if (mainError) errors.push(mainError);

  // Check each thread item
  thread.forEach((item, index) => {
    const length = item.length;
    if (length > limits.maxCharacters) {
      errors.push({
        field: `thread[${index}]`,
        platform,
        message: `Thread item ${index + 1} exceeds ${platform} limit of ${limits.maxCharacters} characters. Current: ${length}`,
      });
    }
  });

  return errors;
}

/**
 * Validate media attachments for a platform
 */
export function validateMedia(
  media: Media[],
  platform: string,
  options?: {
    asCarousel?: boolean;
    isPremium?: boolean;
  }
): ValidationError[] {
  const errors: ValidationError[] = [];
  const limits = getPlatformLimits(platform, options?.isPremium ?? false);
  
  // Check total media count
  if (media.length > limits.maxMedia && !options?.asCarousel) {
    errors.push({
      field: 'media',
      platform,
      message: `${platform} allows maximum ${limits.maxMedia} media item(s). Selected: ${media.length}`,
    });
  }

  // Check carousel limits
  if (options?.asCarousel && limits.supportsCarousel) {
    if (media.length > limits.maxCarouselImages) {
      errors.push({
        field: 'media',
        platform,
        message: `${platform} carousel allows maximum ${limits.maxCarouselImages} images. Selected: ${media.length}`,
      });
    }
    // Carousels only support images
    const nonImages = media.filter(m => m.type !== 'image');
    if (nonImages.length > 0) {
      errors.push({
        field: 'media',
        platform,
        message: `${platform} carousel only supports images. Found: ${nonImages.map(m => m.type).join(', ')}`,
      });
    }
  }

  // LinkedIn non-carousel: only 1 image allowed
  if (platform === 'linkedin' && !options?.asCarousel && media.length > 1) {
    errors.push({
      field: 'media',
      platform,
      message: `LinkedIn posts without carousel can only have 1 image. Selected: ${media.length}. Enable carousel or remove images.`,
    });
  }

  if (platform === 'facebook' && media.length > 1) {
    errors.push({
      field: 'media',
      platform,
      message: 'Facebook video publishing currently supports one media item per post.',
    });
  }

  if (platform === 'youtube' && media.length !== 1) {
    errors.push({
      field: 'media',
      platform,
      message: `YouTube requires exactly 1 video. Selected: ${media.length}`,
    });
  }

  if (platform === 'youtube' && media.some(m => m.type !== 'video')) {
    errors.push({
      field: 'media',
      platform,
      message: 'YouTube publishing only supports video uploads.',
    });
  }

  // Check media types
  const unsupportedTypes = media
    .map(m => m.type)
    .filter(type => !limits.supportedMediaTypes.includes(type as any));
  
  if (unsupportedTypes.length > 0) {
    errors.push({
      field: 'media',
      platform,
      message: `${platform} doesn't support: ${[...new Set(unsupportedTypes)].join(', ')}`,
    });
  }

  return errors;
}

/**
 * Validate a complete post for a single platform
 */
export interface PostValidationInput {
  content: string;
  thread?: string[];
  media: Media[];
  asCarousel?: boolean;
}

export function validatePost(
  input: PostValidationInput,
  platform: string,
  isPremium = false
): ValidationError[] {
  const errors: ValidationError[] = [];

  // Validate content
  const contentError = validateContentLength(input.content, platform, isPremium);
  if (contentError) errors.push(contentError);

  // Validate thread if provided
  if (input.thread && input.thread.length > 0) {
    const threadErrors = validateThreadLengths(input.content, input.thread, platform, isPremium);
    errors.push(...threadErrors);
  }

  // Validate media
  const mediaErrors = validateMedia(input.media, platform, {
    asCarousel: input.asCarousel,
    isPremium,
  });
  errors.push(...mediaErrors);

  return errors;
}

/**
 * Validate posts across multiple platforms with per-platform customization
 */
export interface MultiPlatformPost {
  platform: string;
  content: string;
  thread?: string[];
  media: Media[];
  asCarousel?: boolean;
  isPremium?: boolean;
}

export function validateMultiPlatformPost(posts: MultiPlatformPost[]): ValidationError[] {
  const allErrors: ValidationError[] = [];
  
  for (const post of posts) {
    const errors = validatePost(
      {
        content: post.content,
        thread: post.thread,
        media: post.media,
        asCarousel: post.asCarousel,
      },
      post.platform,
      post.isPremium
    );
    allErrors.push(...errors);
  }

  return allErrors;
}

/**
 * Check if post can be submitted (has no validation errors)
 */
export function isValidPost(
  input: PostValidationInput,
  platform: string,
  isPremium = false
): boolean {
  return validatePost(input, platform, isPremium).length === 0;
}

/**
 * Get human-readable validation summary
 */
export function formatValidationErrors(errors: ValidationError[]): string {
  if (errors.length === 0) return '';
  
  return errors.map(e => `• ${e.platform}: ${e.message}`).join('\n');
}

/**
 * Get remaining character count
 */
export function getRemainingCharacters(content: string, platform: string, isPremium = false): number {
  const limits = getPlatformLimits(platform, isPremium);
  return limits.maxCharacters - content.length;
}

/**
 * Check if content is over the character limit
 */
export function isOverCharacterLimit(content: string, platform: string, isPremium = false): boolean {
  return getRemainingCharacters(content, platform, isPremium) < 0;
}
