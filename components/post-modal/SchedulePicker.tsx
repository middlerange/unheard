// ABOUTME: Date and time picker for scheduling posts.
// ABOUTME: Shows selected date with clear button; validates future dates.

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar, X } from "@/components/icons";
import { useState } from 'react';
import dayjs from 'dayjs';

interface SchedulePickerProps {
  value: Date | null;
  onChange: (date: Date | null) => void;
}

export function SchedulePicker({ value, onChange }: SchedulePickerProps) {
  const [open, setOpen] = useState(false);
  const [dateStr, setDateStr] = useState(value ? dayjs(value).format('YYYY-MM-DD') : '');
  const [timeStr, setTimeStr] = useState(value ? dayjs(value).format('HH:mm') : '');

  function apply() {
    if (!dateStr || !timeStr) return;
    const d = dayjs(`${dateStr}T${timeStr}`);
    if (!d.isValid()) return;
    onChange(d.toDate());
    setOpen(false);
  }

  return (
    <div className="flex items-center gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="text-xs gap-1.5">
            <Calendar className="w-3.5 h-3.5" />
            {value ? dayjs(value).format('MMM D, YYYY [at] h:mm A') : 'Pick schedule time'}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-4 space-y-3" align="start">
          <p className="text-xs font-medium">Schedule for</p>
          <div className="flex flex-col gap-2">
            <input
              type="date"
              value={dateStr}
              min={dayjs().format('YYYY-MM-DD')}
              onChange={e => setDateStr(e.target.value)}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground"
            />
            <input
              type="time"
              value={timeStr}
              onChange={e => setTimeStr(e.target.value)}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground"
            />
          </div>
          <Button size="sm" className="w-full text-xs" onClick={apply} disabled={!dateStr || !timeStr}>
            Set schedule
          </Button>
        </PopoverContent>
      </Popover>

      {value && (
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => onChange(null)}>
          <X className="w-3.5 h-3.5" />
        </Button>
      )}
    </div>
  );
}
