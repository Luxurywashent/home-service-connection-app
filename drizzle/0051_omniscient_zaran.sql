CREATE TABLE `investment_payments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`payment_id` varchar(64) NOT NULL,
	`investment_id` varchar(64) NOT NULL,
	`due_date` varchar(16),
	`paid_date` varchar(16),
	`amount_due` decimal(12,2) NOT NULL,
	`amount_paid` decimal(12,2),
	`status` enum('scheduled','pending','completed','missed','delayed') NOT NULL DEFAULT 'scheduled',
	`payment_method` varchar(64),
	`reference_number` varchar(128),
	`admin_notes` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `investment_payments_id` PRIMARY KEY(`id`),
	CONSTRAINT `investment_payments_payment_id_unique` UNIQUE(`payment_id`)
);
--> statement-breakpoint
CREATE TABLE `investments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`investment_id` varchar(64) NOT NULL,
	`investor_id` varchar(64) NOT NULL,
	`investment_amount` decimal(12,2) NOT NULL,
	`investment_date` varchar(16) NOT NULL,
	`loan_term_months` int,
	`repayment_type` varchar(64) DEFAULT 'monthly',
	`agreed_return_amount` decimal(12,2),
	`total_repayment_amount` decimal(12,2),
	`total_payments_expected` int,
	`status` enum('pending_funding','active','repayment_in_progress','paid_in_full','delayed','document_pending','closed') NOT NULL DEFAULT 'pending_funding',
	`notes` text,
	`admin_notes` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `investments_id` PRIMARY KEY(`id`),
	CONSTRAINT `investments_investment_id_unique` UNIQUE(`investment_id`)
);
--> statement-breakpoint
CREATE TABLE `investor_audit_log` (
	`id` int AUTO_INCREMENT NOT NULL,
	`actor_id` varchar(255) NOT NULL,
	`actor_name` varchar(255),
	`action_type` varchar(64) NOT NULL,
	`record_type` varchar(64) NOT NULL,
	`record_id` varchar(64),
	`metadata` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `investor_audit_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `investor_documents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`document_id` varchar(64) NOT NULL,
	`investor_id` varchar(64) NOT NULL,
	`investment_id` varchar(64),
	`document_title` varchar(255) NOT NULL,
	`document_type` enum('agreement','promissory_note','receipt','statement','tax_document','company_update','other') NOT NULL DEFAULT 'other',
	`file_key` varchar(512) NOT NULL,
	`file_url` varchar(1024),
	`uploaded_by` varchar(255),
	`visibility_status` enum('visible','hidden') NOT NULL DEFAULT 'visible',
	`uploaded_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `investor_documents_id` PRIMARY KEY(`id`),
	CONSTRAINT `investor_documents_document_id_unique` UNIQUE(`document_id`)
);
--> statement-breakpoint
CREATE TABLE `investor_sessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`session_token` varchar(255) NOT NULL,
	`investor_id` varchar(64) NOT NULL,
	`expires_at` timestamp NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `investor_sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `investor_sessions_session_token_unique` UNIQUE(`session_token`)
);
--> statement-breakpoint
CREATE TABLE `investor_support_requests` (
	`id` int AUTO_INCREMENT NOT NULL,
	`request_id` varchar(64) NOT NULL,
	`investor_id` varchar(64) NOT NULL,
	`subject` varchar(255) NOT NULL,
	`message_body` text NOT NULL,
	`status` enum('open','in_review','resolved') NOT NULL DEFAULT 'open',
	`admin_response` text,
	`responded_by` varchar(255),
	`responded_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `investor_support_requests_id` PRIMARY KEY(`id`),
	CONSTRAINT `investor_support_requests_request_id_unique` UNIQUE(`request_id`)
);
--> statement-breakpoint
CREATE TABLE `investor_updates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`update_id` varchar(64) NOT NULL,
	`title` varchar(255) NOT NULL,
	`body` text NOT NULL,
	`category` enum('business_progress','fleet_expansion','revenue_milestone','repayment_update','important_notice','general') NOT NULL DEFAULT 'general',
	`visibility` enum('all_investors','specific') NOT NULL DEFAULT 'all_investors',
	`published_at` timestamp NOT NULL DEFAULT (now()),
	`created_by` varchar(255),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `investor_updates_id` PRIMARY KEY(`id`),
	CONSTRAINT `investor_updates_update_id_unique` UNIQUE(`update_id`)
);
--> statement-breakpoint
CREATE TABLE `investors` (
	`id` int AUTO_INCREMENT NOT NULL,
	`investor_id` varchar(64) NOT NULL,
	`first_name` varchar(128) NOT NULL,
	`last_name` varchar(128) NOT NULL,
	`email` varchar(320) NOT NULL,
	`phone` varchar(32),
	`password_hash` varchar(255) NOT NULL,
	`account_status` enum('active','pending','suspended','closed') NOT NULL DEFAULT 'active',
	`last_login_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `investors_id` PRIMARY KEY(`id`),
	CONSTRAINT `investors_investor_id_unique` UNIQUE(`investor_id`),
	CONSTRAINT `investors_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
ALTER TABLE `notifications` MODIFY COLUMN `notification_type` enum('qc_issue','write_up','missed_step','coaching_note','time_off_update','company_announcement','clock_alert','clock_check_5pm','callback_reminder','job_transfer','ai_booking','repair_request') NOT NULL;