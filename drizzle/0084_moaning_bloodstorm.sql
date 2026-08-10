CREATE TABLE `address_photos` (
	`id` int AUTO_INCREMENT NOT NULL,
	`photo_id` varchar(64) NOT NULL,
	`address_key` varchar(512) NOT NULL,
	`photo_url` text NOT NULL,
	`caption` varchar(255),
	`uploaded_by` varchar(64),
	`uploaded_by_role` varchar(32),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `address_photos_id` PRIMARY KEY(`id`),
	CONSTRAINT `address_photos_photo_id_unique` UNIQUE(`photo_id`)
);
--> statement-breakpoint
CREATE TABLE `qc_records` (
	`id` int AUTO_INCREMENT NOT NULL,
	`qc_id` varchar(64) NOT NULL,
	`job_id` varchar(64) NOT NULL,
	`job_date` varchar(16) NOT NULL,
	`customer_name` varchar(255),
	`customer_phone` varchar(32),
	`detailer_name` varchar(255),
	`city` varchar(128),
	`package_type` varchar(64),
	`called_at` datetime,
	`call_confirmed` tinyint NOT NULL DEFAULT 0,
	`status_qc` enum('pending','pass','fail') NOT NULL DEFAULT 'pending',
	`feedback` text,
	`reviewed_by` varchar(255),
	`reviewed_by_id` varchar(64),
	`created_at_qc` timestamp NOT NULL DEFAULT (now()),
	`updated_at_qc` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `qc_records_id` PRIMARY KEY(`id`),
	CONSTRAINT `qc_records_qc_id_unique` UNIQUE(`qc_id`),
	CONSTRAINT `qc_records_job_id_unique` UNIQUE(`job_id`)
);
--> statement-breakpoint
ALTER TABLE `email_logs` MODIFY COLUMN `type` enum('booking_confirmation','notification','other','review_request') NOT NULL DEFAULT 'other';--> statement-breakpoint
ALTER TABLE `email_queue` MODIFY COLUMN `type` enum('booking_confirmation','notification','review_request','other') NOT NULL DEFAULT 'other';