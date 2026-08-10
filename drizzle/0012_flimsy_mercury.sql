CREATE TABLE `training_modules` (
	`id` int AUTO_INCREMENT NOT NULL,
	`module_id` varchar(64) NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`icon` varchar(64),
	`order_index` int NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `training_modules_id` PRIMARY KEY(`id`),
	CONSTRAINT `training_modules_module_id_unique` UNIQUE(`module_id`)
);
--> statement-breakpoint
CREATE TABLE `training_steps` (
	`id` int AUTO_INCREMENT NOT NULL,
	`step_id` varchar(64) NOT NULL,
	`module_id` varchar(64) NOT NULL,
	`order_index` int NOT NULL,
	`title` varchar(512) NOT NULL,
	`description` text NOT NULL,
	`image_url` text,
	`warnings` text,
	`tips` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `training_steps_id` PRIMARY KEY(`id`),
	CONSTRAINT `training_steps_step_id_unique` UNIQUE(`step_id`)
);
--> statement-breakpoint
CREATE TABLE `training_tools` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tool_id` varchar(64) NOT NULL,
	`module_id` varchar(64) NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`image_url` text,
	`order_index` int NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `training_tools_id` PRIMARY KEY(`id`),
	CONSTRAINT `training_tools_tool_id_unique` UNIQUE(`tool_id`)
);
--> statement-breakpoint
CREATE TABLE `user_training_progress` (
	`id` int AUTO_INCREMENT NOT NULL,
	`progress_id` varchar(64) NOT NULL,
	`employee_id` varchar(64) NOT NULL,
	`module_id` varchar(64) NOT NULL,
	`completed_steps` text,
	`is_module_completed` enum('yes','no') NOT NULL DEFAULT 'no',
	`completed_at` timestamp,
	`started_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `user_training_progress_id` PRIMARY KEY(`id`),
	CONSTRAINT `user_training_progress_progress_id_unique` UNIQUE(`progress_id`)
);
--> statement-breakpoint
ALTER TABLE `door_hanger_entries` ADD `photo_urls` text;--> statement-breakpoint
ALTER TABLE `door_hanger_goals` ADD `daily_door_hanger_goal` int DEFAULT 50 NOT NULL;--> statement-breakpoint
ALTER TABLE `door_hanger_goals` ADD `daily_business_card_goal` int DEFAULT 20 NOT NULL;--> statement-breakpoint
ALTER TABLE `door_hanger_goals` ADD `daily_yard_sign_goal` int DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE `door_hanger_goals` ADD `daily_table_topper_goal` int DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE `door_hanger_goals` DROP COLUMN `door_hanger_goal`;--> statement-breakpoint
ALTER TABLE `door_hanger_goals` DROP COLUMN `business_card_goal`;--> statement-breakpoint
ALTER TABLE `door_hanger_goals` DROP COLUMN `yard_sign_goal`;