import { readFileSync } from 'node:fs';
import { Module } from '@nestjs/common';
import { getSubwayDataPath } from '../../common/utils/subway-data-path';
import { TrainScheduleFile } from '../../domain/arrival/models/train-schedule';
import { HOLIDAY_CALENDAR } from '../../domain/arrival/ports/IHolidayCalendar';
import { NEXT_TRAIN_PROVIDER } from '../../domain/arrival/ports/INextTrainProvider';
import { SubwayModule } from '../../domain/subway/subway.module';
import { PublicDataHolidayCalendar } from '../../infra/arrival/public-data-holiday.calendar';
import {
  TRAIN_SCHEDULE,
  TimetableNextTrainProvider,
} from '../../infra/arrival/timetable-next-train.provider';
import { ArrivalController } from './arrival.controller';
import { ArrivalService } from './arrival.service';

@Module({
  imports: [SubwayModule],
  controllers: [ArrivalController],
  providers: [
    ArrivalService,
    {
      provide: TRAIN_SCHEDULE,
      useFactory: (): TrainScheduleFile =>
        JSON.parse(readFileSync(getSubwayDataPath('next-train-schedule.json'), 'utf-8')),
    },
    { provide: HOLIDAY_CALENDAR, useClass: PublicDataHolidayCalendar },
    { provide: NEXT_TRAIN_PROVIDER, useClass: TimetableNextTrainProvider },
  ],
})
export class ArrivalModule {}
