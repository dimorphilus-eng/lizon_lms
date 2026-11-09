import { Global, Module } from "@nestjs/common";
import { PolicyService } from "./policy.service";
import { ProgressService } from "./progress.service";

@Global()
@Module({ providers: [PolicyService, ProgressService], exports: [PolicyService, ProgressService] })
export class AccessModule {}
