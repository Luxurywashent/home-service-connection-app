CREATE TABLE `finance_vendors` (
	`id` int AUTO_INCREMENT NOT NULL,
	`vendor_id` varchar(64) NOT NULL,
	`name` varchar(255) NOT NULL,
	`category` varchar(128),
	`phone` varchar(32),
	`email` varchar(255),
	`website` varchar(255),
	`login_email` varchar(255),
	`login_password` varchar(255),
	`notes` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `finance_vendors_id` PRIMARY KEY(`id`),
	CONSTRAINT `finance_vendors_vendor_id_unique` UNIQUE(`vendor_id`)
);
