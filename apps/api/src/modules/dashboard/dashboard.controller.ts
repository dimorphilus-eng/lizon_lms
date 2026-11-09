import { Controller, Get } from "@nestjs/common";
import { CurrentUser } from "../../common/decorators";
import type { Actor } from "../../common/actor";
import { DashboardService } from "./dashboard.service";

@Controller("dashboard")
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get("student")
  student(@CurrentUser() actor: Actor) {
    return this.dashboard.student(actor);
  }

  @Get("teacher")
  teacher(@CurrentUser() actor: Actor) {
    return this.dashboard.teacher(actor);
  }
}
