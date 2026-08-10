ALTER TABLE `receptionist_call_logs` ADD `transcript` text;--> statement-breakpoint
ALTER TABLE `receptionist_call_logs` ADD `recording_url` varchar(512);--> statement-breakpoint
ALTER TABLE `receptionist_call_logs` ADD `caller_name` varchar(128);--> statement-breakpoint
ALTER TABLE `schedule_jobs` ADD `upsell_total` decimal(10,2) DEFAULT '0';