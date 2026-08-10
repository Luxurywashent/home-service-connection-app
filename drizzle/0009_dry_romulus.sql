DROP TABLE `door_hanger_goals`;--> statement-breakpoint
ALTER TABLE `employees` MODIFY COLUMN `role` enum('detailer','admin','office','operations_manager') NOT NULL;