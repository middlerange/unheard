ALTER TABLE `posts` ADD COLUMN `brand_id` text REFERENCES `brand_profiles`(`id`) ON DELETE SET NULL;

UPDATE `posts`
SET `brand_id` = (
  SELECT `brand_profiles`.`id`
  FROM `brand_profiles`
  WHERE `brand_profiles`.`team_id` = `posts`.`team_id`
    AND `brand_profiles`.`writing_prompt` = `posts`.`writing_prompt`
  ORDER BY `brand_profiles`.`is_default` DESC
  LIMIT 1
)
WHERE `brand_id` IS NULL
  AND `writing_prompt` IS NOT NULL;
