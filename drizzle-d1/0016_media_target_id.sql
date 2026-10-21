ALTER TABLE `media` ADD `target_id` text REFERENCES post_targets(id) ON DELETE cascade;
