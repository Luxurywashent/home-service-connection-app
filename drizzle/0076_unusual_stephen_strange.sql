CREATE TABLE `interactive_module_folders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name_imf` varchar(128) NOT NULL,
	`emoji_imf` varchar(16) NOT NULL DEFAULT '📁',
	`order_index_imf` int NOT NULL DEFAULT 0,
	`is_collapsed_imf` tinyint NOT NULL DEFAULT 0,
	`created_at_imf` timestamp NOT NULL DEFAULT (now()),
	`updated_at_imf` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `interactive_module_folders_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `interactive_module_steps` (
	`id` int AUTO_INCREMENT NOT NULL,
	`module_key` varchar(128) NOT NULL,
	`step_id` varchar(64) NOT NULL,
	`title` varchar(512) NOT NULL,
	`instruction` text NOT NULL,
	`area` varchar(255),
	`question` text,
	`choices` json,
	`correct_id` varchar(64),
	`wrong_explanation` text,
	`correct_explanation` text,
	`pro_tip` text,
	`order_index` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `interactive_module_steps_id` PRIMARY KEY(`id`),
	CONSTRAINT `interactive_module_steps_step_id_unique` UNIQUE(`step_id`)
);
--> statement-breakpoint
CREATE TABLE `module_tools` (
	`id` int AUTO_INCREMENT NOT NULL,
	`module_key` varchar(128) NOT NULL,
	`name` varchar(255) NOT NULL,
	`photo_url` varchar(1024),
	`category` varchar(32) NOT NULL DEFAULT 'tool',
	`order_index` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `module_tools_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `interactive_modules` ADD `folder_id_im` int DEFAULT null;--> statement-breakpoint
ALTER TABLE `interactive_step_overrides` ADD `is_deleted_iso` boolean DEFAULT false NOT NULL;