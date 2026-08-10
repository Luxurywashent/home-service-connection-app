CREATE TABLE `ops_daily_checklist` (
	`id` int AUTO_INCREMENT NOT NULL,
	`date_odc` varchar(16) NOT NULL,
	`ops_manager_id_odc` varchar(64) NOT NULL,
	`site_inspections_odc` int NOT NULL DEFAULT 0,
	`van_inspections_odc` int NOT NULL DEFAULT 0,
	`door_hangers_odc` int NOT NULL DEFAULT 0,
	`inventory_check_odc` tinyint NOT NULL DEFAULT 0,
	`morning_team_check_in_odc` tinyint NOT NULL DEFAULT 0,
	`afternoon_team_check_in_odc` tinyint NOT NULL DEFAULT 0,
	`qc_calls_done_odc` tinyint NOT NULL DEFAULT 0,
	`updated_at_odc` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ops_daily_checklist_id` PRIMARY KEY(`id`)
);
