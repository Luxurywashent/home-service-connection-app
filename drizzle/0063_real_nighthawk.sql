CREATE TABLE `site_inspection_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`item_id_si` varchar(64) NOT NULL,
	`inspection_id_ref` varchar(64) NOT NULL,
	`check_key` varchar(64) NOT NULL,
	`check_label` varchar(255) NOT NULL,
	`passed` tinyint NOT NULL DEFAULT 1,
	`notes_sii` text,
	CONSTRAINT `site_inspection_items_id` PRIMARY KEY(`id`),
	CONSTRAINT `site_inspection_items_item_id_si_unique` UNIQUE(`item_id_si`)
);
--> statement-breakpoint
CREATE TABLE `site_inspections` (
	`id` int AUTO_INCREMENT NOT NULL,
	`inspection_id` varchar(64) NOT NULL,
	`ops_manager_id` varchar(64) NOT NULL,
	`ops_manager_name` varchar(255),
	`detailer_id` varchar(64) NOT NULL,
	`detailer_name` varchar(255),
	`booking_id` varchar(64),
	`job_address` varchar(500),
	`inspected_at` datetime NOT NULL,
	`overall_pass` tinyint NOT NULL DEFAULT 1,
	`notes_si` text,
	`created_at_si` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `site_inspections_id` PRIMARY KEY(`id`),
	CONSTRAINT `site_inspections_inspection_id_unique` UNIQUE(`inspection_id`)
);
--> statement-breakpoint
CREATE TABLE `van_checklist_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`item_id_vci` varchar(64) NOT NULL,
	`checklist_id_vci` varchar(64) NOT NULL,
	`category_vci` varchar(64) NOT NULL,
	`item_name_vci` varchar(255) NOT NULL,
	`present` tinyint NOT NULL DEFAULT 1,
	CONSTRAINT `van_checklist_items_id` PRIMARY KEY(`id`),
	CONSTRAINT `van_checklist_items_item_id_vci_unique` UNIQUE(`item_id_vci`)
);
--> statement-breakpoint
CREATE TABLE `van_checklists` (
	`id` int AUTO_INCREMENT NOT NULL,
	`checklist_id_vc` varchar(64) NOT NULL,
	`ops_manager_id_vc` varchar(64) NOT NULL,
	`ops_manager_name_vc` varchar(255),
	`detailer_id_vc` varchar(64) NOT NULL,
	`detailer_name_vc` varchar(255),
	`submitted_at_vc` datetime NOT NULL,
	`all_items_present` tinyint NOT NULL DEFAULT 1,
	`notes_vc` text,
	`created_at_vc` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `van_checklists_id` PRIMARY KEY(`id`),
	CONSTRAINT `van_checklists_checklist_id_vc_unique` UNIQUE(`checklist_id_vc`)
);
