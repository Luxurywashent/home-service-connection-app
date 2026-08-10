CREATE TABLE `van_checklist_custom_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`category_vcci` varchar(64) NOT NULL,
	`item_name_vcci` varchar(255) NOT NULL,
	`action_vcci` varchar(8) NOT NULL DEFAULT 'add',
	`created_at_vcci` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `van_checklist_custom_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `online_bookings` ADD `resume_token` varchar(128);