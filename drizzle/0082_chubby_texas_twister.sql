CREATE TABLE `chat_last_seen` (
	`id` int AUTO_INCREMENT NOT NULL,
	`employee_id` varchar(64) NOT NULL,
	`channel_key` varchar(128) NOT NULL,
	`last_seen_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at_cls` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `chat_last_seen_id` PRIMARY KEY(`id`)
);
