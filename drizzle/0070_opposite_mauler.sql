CREATE TABLE `meeting_attendance` (
	`id` int AUTO_INCREMENT NOT NULL,
	`attendance_id` varchar(64) NOT NULL,
	`employee_id` varchar(64) NOT NULL,
	`full_name` varchar(255) NOT NULL,
	`meeting_date` varchar(16) NOT NULL,
	`attended_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `meeting_attendance_id` PRIMARY KEY(`id`),
	CONSTRAINT `meeting_attendance_attendance_id_unique` UNIQUE(`attendance_id`)
);
