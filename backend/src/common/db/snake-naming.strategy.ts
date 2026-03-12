import { DefaultNamingStrategy, NamingStrategyInterface } from 'typeorm';
import { snakeCase } from 'typeorm/util/StringUtils';

export class SnakeNamingStrategy
  extends DefaultNamingStrategy
  implements NamingStrategyInterface
{
  tableName(className: string, customName: string): string {
    return customName ? customName : snakeCase(className);
  }

  columnName(propertyName: string, customName: string, embeddedPrefixes: string[]): string {
    const name = customName ? customName : propertyName;
    return snakeCase(embeddedPrefixes.concat([name]).join('_'));
  }

  relationName(propertyName: string): string {
    return snakeCase(propertyName);
  }

  joinColumnName(relationName: string, referencedColumnName: string): string {
    return snakeCase(`${relationName}_${referencedColumnName}`);
  }

  joinTableName(
    firstTableName: string,
    secondTableName: string,
    firstPropertyName: string,
    secondPropertyName: string,
  ): string {
    return snakeCase(`${firstTableName}_${firstPropertyName}_${secondTableName}_${secondPropertyName}`);
  }

  joinTableColumnName(tableName: string, propertyName: string, columnName?: string): string {
    return snakeCase(`${tableName}_${columnName ? columnName : propertyName}`);
  }

  classTableInheritanceParentColumnName(parentTableName: string, parentTableIdPropertyName: string): string {
    return snakeCase(`${parentTableName}_${parentTableIdPropertyName}`);
  }
}
