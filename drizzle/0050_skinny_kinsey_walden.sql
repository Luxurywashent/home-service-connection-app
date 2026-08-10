CREATE TABLE `employee_van_assignments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`employee_id` varchar(64) NOT NULL,
	`van_id` varchar(64) NOT NULL,
	`van_name` varchar(128),
	`assigned_at` timestamp NOT NULL DEFAULT (now()),
	`assigned_by` varchar(255),
	CONSTRAINT `employee_van_assignments_id` PRIMARY KEY(`id`),
	CONSTRAINT `employee_van_assignments_employee_id_unique` UNIQUE(`employee_id`)
);
--> statement-breakpoint
CREATE TABLE `repair_equipment` (
	`id` int AUTO_INCREMENT NOT NULL,
	`equipment_id` varchar(64) NOT NULL,
	`name` varchar(128) NOT NULL,
	`category` varchar(64),
	`sub_issues` text,
	`is_active` tinyint NOT NULL DEFAULT 1,
	`sort_order` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `repair_equipment_id` PRIMARY KEY(`id`),
	CONSTRAINT `repair_equipment_equipment_id_unique` UNIQUE(`equipment_id`)
);
--> statement-breakpoint
CREATE TABLE `repair_orders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`repair_id` varchar(64) NOT NULL,
	`van_id` varchar(64) NOT NULL,
	`van_name` varchar(128),
	`employee_id` varchar(64) NOT NULL,
	`employee_name` varchar(255),
	`equipment_id` varchar(64) NOT NULL,
	`equipment_name` varchar(128) NOT NULL,
	`sub_issue` varchar(255),
	`notes` text,
	`status` enum('open','in_progress','resolved') NOT NULL DEFAULT 'open',
	`priority` enum('low','medium','high') NOT NULL DEFAULT 'medium',
	`resolved_at` timestamp,
	`resolved_by` varchar(255),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `repair_orders_id` PRIMARY KEY(`id`),
	CONSTRAINT `repair_orders_repair_id_unique` UNIQUE(`repair_id`)
);
