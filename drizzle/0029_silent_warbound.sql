CREATE TABLE `morning_meeting_config` (
	`id` int AUTO_INCREMENT NOT NULL,
	`zoom_link` text NOT NULL,
	`meeting_time` varchar(16) NOT NULL DEFAULT '07:30',
	`enabled` enum('yes','no') NOT NULL DEFAULT 'yes',
	`updated_by` varchar(64),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `morning_meeting_config_id` PRIMARY KEY(`id`)
);
