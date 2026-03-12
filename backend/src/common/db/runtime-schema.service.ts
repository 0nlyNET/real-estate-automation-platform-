import { Injectable, OnModuleInit } from "@nestjs/common"
import { DataSource } from "typeorm"
import fs from "fs"
import path from "path"

@Injectable()
export class RuntimeSchemaService implements OnModuleInit {
  constructor(private readonly dataSource: DataSource) {}

  async onModuleInit() {
    const sqlPath = path.join(__dirname, "ensure-leads-columns.sql")
    if (!fs.existsSync(sqlPath)) return

    const sql = fs.readFileSync(sqlPath, "utf8")

    try {
      await this.dataSource.query(sql)
      console.log("[Schema] Lead columns verified")
    } catch (err) {
      console.error("[Schema] Failed to apply schema guard:", err)
    }
  }
}
