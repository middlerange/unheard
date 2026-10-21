// ABOUTME: LinkedIn-specific post settings — carousel toggle and slide name.
// ABOUTME: Ported from postiz-app linkedin.provider.tsx settings panel.

import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Linkedin } from "@/components/icons";

interface LinkedInSettingsProps {
  asCarousel: boolean;
  carouselName: string;
  onChange: (patch: { as_carousel?: boolean; carousel_name?: string }) => void;
}

export function LinkedInSettings({ asCarousel, carouselName, onChange }: LinkedInSettingsProps) {
  return (
    <div className="flex flex-col gap-2 p-3 rounded-lg bg-muted/50 border border-input">
      <div className="flex items-center gap-3">
        <Linkedin className="w-4 h-4 text-[#0a66c2] flex-shrink-0" />
        <div className="flex items-center gap-2">
          <Checkbox
            id="carousel"
            checked={asCarousel}
            onCheckedChange={v => onChange({ as_carousel: Boolean(v) })}
          />
          <Label htmlFor="carousel" className="text-xs cursor-pointer">Post images as carousel</Label>
        </div>
      </div>

      {asCarousel && (
        <div className="flex items-center gap-2 ml-7">
          <Label className="text-xs text-muted-foreground whitespace-nowrap">Slide name</Label>
          <Input
            value={carouselName}
            onChange={e => onChange({ carousel_name: e.target.value })}
            placeholder="Optional slide label"
            className="h-7 text-xs flex-1"
          />
        </div>
      )}
    </div>
  );
}
