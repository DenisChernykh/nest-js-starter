import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
} from '@nestjs/common'
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger'

import {
  CurrentPrincipal,
  RequirePermission,
  type AuthenticatedPrincipal,
} from '@/modules/identity-access'
import { ApiProblemResponses } from '@/platform/http/docs/api-problem-responses.decorator'
import { CreateApprovalRequestUseCase } from '../application/create-approval-request.use-case'
import { DecideApprovalRequestUseCase } from '../application/decide-approval-request.use-case'
import { GetApprovalRequestQuery } from '../application/get-approval-request.query'
import {
  APPROVAL_REQUEST_DECIDE_PERMISSION,
  APPROVAL_REQUEST_READ_PERMISSION,
} from '../application/approval-request-permissions'
import type { ApprovalRequest } from '../domain/approval-request'
import {
  ApprovalRequestPathDto,
  CreateApprovalRequestDto,
  DecideApprovalRequestDto,
} from './approval-request.dto'
import {
  APPROVAL_REQUEST_ALREADY_DECIDED_PROBLEM,
  APPROVAL_REQUEST_NOT_FOUND_PROBLEM,
  APPROVAL_SELF_DECISION_FORBIDDEN_PROBLEM,
} from './approval-request-problem.definitions'
import { ApprovalRequestResponseDto } from './approval-request-response.dto'

/** Authenticated HTTP boundary for the approval-request reference workflow. */
@Controller('approval-requests')
@ApiTags('approval-requests')
export class ApprovalRequestController {
  public constructor(
    @Inject(CreateApprovalRequestUseCase)
    private readonly createUseCase: CreateApprovalRequestUseCase,
    @Inject(GetApprovalRequestQuery)
    private readonly getQuery: GetApprovalRequestQuery,
    @Inject(DecideApprovalRequestUseCase)
    private readonly decideUseCase: DecideApprovalRequestUseCase,
  ) {}

  /**
   * Creates one pending request owned by the authenticated actor.
   *
   * @param body - Validated and edge-trimmed request content.
   * @param principal - Fresh principal attached by the auth boundary.
   * @returns The persisted pending public projection.
   * @throws Error when validation, authentication or persistence fails.
   */
  @Post()
  @HttpCode(201)
  @ApiOperation({
    operationId: 'approvalRequestsCreate',
    summary: 'Create an approval request',
    security: [{ sessionCookie: [], csrfToken: [] }],
  })
  @ApiBody({ type: CreateApprovalRequestDto })
  @ApiCreatedResponse({
    type: ApprovalRequestResponseDto,
    description: 'Pending approval request persisted for the current author.',
  })
  @ApiProblemResponses(
    'MALFORMED_REQUEST',
    'AUTHENTICATION_REQUIRED',
    'AUTHORIZATION_DENIED',
    'PAYLOAD_TOO_LARGE',
    'UNSUPPORTED_MEDIA_TYPE',
    'VALIDATION_FAILED',
    'INTERNAL_ERROR',
    'DEPENDENCY_UNAVAILABLE',
  )
  public async create(
    @Body() body: CreateApprovalRequestDto,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ): Promise<ApprovalRequestResponseDto> {
    return mapApprovalRequestResponse(
      await this.createUseCase.execute({
        actorUserId: principal.userId,
        title: body.title,
        description: body.description,
      }),
    )
  }

  /**
   * Reads one request visible to the authenticated actor.
   *
   * @param path - Validated UUID route identity.
   * @param principal - Fresh principal used only to derive scalar visibility input.
   * @returns The visible persisted public projection.
   * @throws ApprovalRequestNotFoundError when the request is absent or hidden.
   * @throws Error when authentication or persistence fails.
   */
  @Get(':requestId')
  @ApiOperation({
    operationId: 'approvalRequestsGet',
    summary: 'Get an approval request',
    security: [{ sessionCookie: [] }],
  })
  @ApiParam({
    name: 'requestId',
    required: true,
    schema: {
      type: 'string',
      format: 'uuid',
      example: '8dc70a15-d91f-4c67-b5a6-479faa42433c',
    },
  })
  @ApiOkResponse({
    type: ApprovalRequestResponseDto,
    description: 'Approval request visible to the current actor.',
  })
  @ApiProblemResponses(
    'VALIDATION_FAILED',
    'AUTHENTICATION_REQUIRED',
    APPROVAL_REQUEST_NOT_FOUND_PROBLEM,
    'INTERNAL_ERROR',
    'DEPENDENCY_UNAVAILABLE',
  )
  public async get(
    @Param() path: ApprovalRequestPathDto,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ): Promise<ApprovalRequestResponseDto> {
    return mapApprovalRequestResponse(
      await this.getQuery.execute({
        actorUserId: principal.userId,
        requestId: path.requestId,
        mayReadAny: principal.permissions.has(APPROVAL_REQUEST_READ_PERMISSION),
      }),
    )
  }

  /**
   * Records one terminal decision by an authorized non-author reviewer.
   *
   * @param path - Validated UUID route identity.
   * @param body - Validated finite terminal decision.
   * @param principal - Fresh principal reduced to the reviewer identifier.
   * @returns The terminal persisted public projection.
   * @throws ApprovalRequestNotFoundError when the request is absent.
   * @throws ApprovalRequestAlreadyDecidedError when a terminal value already exists.
   * @throws ApprovalSelfDecisionForbiddenError when the reviewer is the author.
   * @throws Error when authorization, validation or persistence fails.
   */
  @Put(':requestId/decision')
  @RequirePermission(APPROVAL_REQUEST_DECIDE_PERMISSION)
  @ApiOperation({
    operationId: 'approvalRequestsDecide',
    summary: 'Decide an approval request',
    security: [{ sessionCookie: [], csrfToken: [] }],
  })
  @ApiParam({
    name: 'requestId',
    required: true,
    schema: {
      type: 'string',
      format: 'uuid',
      example: '8dc70a15-d91f-4c67-b5a6-479faa42433c',
    },
  })
  @ApiBody({ type: DecideApprovalRequestDto })
  @ApiOkResponse({
    type: ApprovalRequestResponseDto,
    description: 'Approval request with its recorded terminal decision.',
  })
  @ApiProblemResponses(
    'MALFORMED_REQUEST',
    'AUTHENTICATION_REQUIRED',
    'AUTHORIZATION_DENIED',
    'PAYLOAD_TOO_LARGE',
    'UNSUPPORTED_MEDIA_TYPE',
    'VALIDATION_FAILED',
    APPROVAL_REQUEST_NOT_FOUND_PROBLEM,
    APPROVAL_REQUEST_ALREADY_DECIDED_PROBLEM,
    APPROVAL_SELF_DECISION_FORBIDDEN_PROBLEM,
    'INTERNAL_ERROR',
    'DEPENDENCY_UNAVAILABLE',
  )
  public async decide(
    @Param() path: ApprovalRequestPathDto,
    @Body() body: DecideApprovalRequestDto,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ): Promise<ApprovalRequestResponseDto> {
    return mapApprovalRequestResponse(
      await this.decideUseCase.execute({
        actorUserId: principal.userId,
        requestId: path.requestId,
        decision: body.decision,
      }),
    )
  }
}

function mapApprovalRequestResponse(
  request: ApprovalRequest,
): ApprovalRequestResponseDto {
  return {
    id: request.id,
    title: request.title,
    description: request.description,
    status: request.status,
    createdByUserId: request.createdByUserId,
    decidedByUserId: request.decidedByUserId ?? null,
    createdAt: request.createdAt,
    decidedAt: request.decidedAt ?? null,
  }
}
