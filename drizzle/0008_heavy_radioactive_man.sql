CREATE TABLE `door_hanger_goals` (
	`id` int AUTO_INCREMENT NOT NULL,
	`goal_id` varchar(64) NOT NULL,
	`door_hanger_goal` int NOT NULL DEFAULT 250,
	`business_card_goal` int NOT NULL DEFAULT 50,
	`yard_sign_goal` int NOT NULL DEFAULT 5,
	`updated_by` varchar(64),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `door_hanger_goals_id` PRIMARY KEY(`id`),
	CONSTRAINT `door_hanger_goals_goal_id_unique` UNIQUE(`goal_id`)
);
--> statement-breakpoint
ALTER TABLE `employees` MODIFY COLUMN `role` enum('detailer','admin','office','operations_manager','door_hanger_rep') NOT NULL;