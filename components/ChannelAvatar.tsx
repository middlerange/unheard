// ABOUTME: Avatar component showing a profile photo with a social platform badge overlay.
// ABOUTME: Used in the sidebar channels section and post modal platform picker.

import { forwardRef, type ComponentPropsWithoutRef, type MouseEventHandler } from 'react';
import { Linkedin, Instagram, Facebook, Youtube } from "@/components/icons";
import { RedditLogo } from '@/components/RedditLogo';
import { cn } from '@/lib/utils';
import type { PlatformId } from '@/lib/platforms';

function XLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.742l7.727-8.867L1.254 2.25H8.08l4.262 5.633 5.9-5.633zm-1.16 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function DiscordLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
    </svg>
  );
}

interface ChannelAvatarProps extends ComponentPropsWithoutRef<'button'> {
  platform: PlatformId;
  active?: boolean;
  onPress?: () => void;
  className?: string;
  label?: string;
}

export const ChannelAvatar = forwardRef<HTMLButtonElement, ChannelAvatarProps>(
  function ChannelAvatar(
    {
      platform,
      active,
      onPress,
      className,
      label,
      onClick,
      disabled,
      title,
      type,
      'aria-label': ariaLabel,
      ...rest
    },
    ref,
  ) {
  const handleClick: MouseEventHandler<HTMLButtonElement> = event => {
    onClick?.(event);
    if (event.defaultPrevented) return;
    onPress?.();
  };

  const getPlatformStyles = () => {
    switch (platform) {
      case 'twitter':
        return 'bg-black text-white';
      case 'linkedin':
        return 'bg-[#0a66c2] text-white';
      case 'instagram':
        return 'bg-[#E4405F] text-white';
      case 'facebook':
        return 'bg-[#1877F2] text-white';
      case 'youtube':
        return 'bg-[#FF0000] text-white';
      case 'reddit':
        return 'bg-[#FF4500] text-white';
      case 'discord':
        return 'bg-[#5865F2] text-white';
      default:
        return 'bg-gray-500 text-white';
    }
  };

  const getPlatformIcon = () => {
    switch (platform) {
      case 'twitter':
        return <XLogo className="w-2 h-2" />;
      case 'linkedin':
        return <Linkedin className="w-2 h-2 fill-white stroke-none" />;
      case 'instagram':
        return <Instagram className="w-2 h-2" />;
      case 'facebook':
        return <Facebook className="w-2 h-2 fill-white stroke-none" />;
      case 'youtube':
        return <Youtube className="w-2 h-2 fill-white stroke-none" />;
      case 'reddit':
        return <RedditLogo className="w-2 h-2" />;
      case 'discord':
        return <DiscordLogo className="w-2 h-2" />;
      default:
        return null;
    }
  };

  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      onClick={handleClick}
      disabled={disabled ?? !onPress}
      title={title ?? label}
      aria-label={ariaLabel ?? label}
      className={cn(
        'relative inline-flex items-center justify-center group',
        onPress ? 'cursor-pointer' : 'cursor-default',
        className,
      )}
      {...rest}
    >
      <img
        src="/dp.jpeg"
        alt="Profile"
        className={cn(
          'w-7 h-7 rounded-full object-cover ring-2 ring-transparent transition-all',
          active === false && 'opacity-40 grayscale',
          active === true && 'ring-primary',
          onPress && active !== false && 'group-hover:ring-primary/50',
        )}
      />
      <span
        className={cn(
          'absolute -bottom-0.5 -right-0.5 flex items-center justify-center w-[13px] h-[13px] rounded-sm',
          getPlatformStyles(),
        )}
      >
        {getPlatformIcon()}
      </span>
    </button>
  );
});
