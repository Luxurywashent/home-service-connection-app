CREATE TABLE `interactive_modules` (
	`id` int AUTO_INCREMENT NOT NULL,
	`module_key` varchar(64) NOT NULL,
	`title_im` varchar(255) NOT NULL,
	`subtitle_im` varchar(255) NOT NULL,
	`emoji_im` varchar(16) NOT NULL,
	`color_im` varchar(16) NOT NULL,
	`bg_color_im` varchar(16) NOT NULL,
	`step_count_im` int NOT NULL DEFAULT 0,
	`route_im` varchar(128) NOT NULL,
	`order_index_im` int NOT NULL DEFAULT 0,
	`is_active_im` tinyint NOT NULL DEFAULT 1,
	`created_at_im` timestamp NOT NULL DEFAULT (now()),
	`updated_at_im` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `interactive_modules_id` PRIMARY KEY(`id`),
	CONSTRAINT `interactive_modules_module_key_unique` UNIQUE(`module_key`)
);
--> statement-breakpoint
CREATE TABLE `portal_messages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`customer_id` int NOT NULL,
	`direction` varchar(10) NOT NULL,
	`body` text NOT NULL,
	`sent_by_employee_id` varchar(50),
	`sent_by_name` varchar(100),
	`is_read` tinyint NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `portal_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `training_modules` ADD `quiz_title` varchar(255);