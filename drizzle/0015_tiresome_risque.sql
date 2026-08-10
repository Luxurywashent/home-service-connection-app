CREATE TABLE `team_chat_messages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`message_id` varchar(64) NOT NULL,
	`employee_id` varchar(64) NOT NULL,
	`full_name` varchar(255) NOT NULL,
	`profile_photo_url` text,
	`message_text` text,
	`image_url` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `team_chat_messages_id` PRIMARY KEY(`id`),
	CONSTRAINT `team_chat_messages_message_id_unique` UNIQUE(`message_id`)
);
