ALTER TABLE `team_chat_messages` ADD `channel` varchar(64) DEFAULT 'general' NOT NULL;--> statement-breakpoint
ALTER TABLE `team_chat_messages` ADD `recipient_id` varchar(64);