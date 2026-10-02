import {
  IsArray,
  ArrayMinSize,
  ArrayMaxSize,
  ArrayUnique,
  IsUUID,
  IsString,
  Length,
  IsEmail,
  IsIn,
  IsInt,
  Min,
  Max,
  IsISO8601,
  IsOptional,
  Matches,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
export class LoginDto {
  @ApiProperty() @IsEmail() @Length(3, 150) email!: string;
  @ApiProperty() @IsString() @Length(12, 128) password!: string;
}
export class RegisterDto extends LoginDto {
  @ApiProperty() @IsString() @Length(2, 80) name!: string;
}
export class HoldDto {
  @ApiProperty() @IsUUID() eventId!: string;
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(6)
  @ArrayUnique()
  @IsUUID("all", { each: true })
  seatIds!: string[];
}
export class SettleDto {
  @ApiProperty({ enum: ["SUCCEEDED", "FAILED"] })
  @IsIn(["SUCCEEDED", "FAILED"])
  outcome!: "SUCCEEDED" | "FAILED";
}
export class WebhookDto {
  @ApiProperty()
  @IsString()
  @Matches(/^[a-zA-Z0-9_-]{8,100}$/)
  eventId!: string;
  @ApiProperty() @IsUUID() paymentId!: string;
  @ApiProperty({ enum: ["SUCCEEDED", "FAILED"] })
  @IsIn(["SUCCEEDED", "FAILED"])
  outcome!: "SUCCEEDED" | "FAILED";
  @ApiProperty() @IsInt() @Min(1) @Max(100000000) amount!: number;
  @ApiProperty() @IsIn(["BDT"]) currency!: string;
}
export class EventDto {
  @ApiProperty() @IsString() @Length(3, 100) title!: string;
  @ApiProperty() @IsString() @Length(3, 120) venue!: string;
  @ApiProperty() @IsString() @Length(2, 60) city!: string;
  @ApiProperty() @IsString() @Length(10, 1000) description!: string;
  @ApiProperty() @IsISO8601() startsAt!: string;
  @ApiProperty() @IsInt() @Min(1) @Max(12) rows!: number;
  @ApiProperty() @IsInt() @Min(4) @Max(20) seatsPerRow!: number;
  @ApiProperty({ description: "Integer paisa; 10000 = BDT 100" })
  @IsInt()
  @Min(100)
  @Max(1000000)
  price!: number;
}
export class CheckinDto {
  @ApiProperty() @IsString() @Matches(/^[a-f0-9]{64}$/) token!: string;
}

export class StaffDto {
  @ApiProperty() @IsUUID() userId!: string;
}
