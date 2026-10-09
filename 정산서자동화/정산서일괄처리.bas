Attribute VB_Name = "정산서일괄처리"
Option Explicit

' =====================================================================
' 정산서 일괄처리
'  - 정산서_이미지_일괄저장 : 정산일의 모든 업체 정산서를 PNG 파일로 저장
'  - 정산서_순차복사       : 업체별 정산서를 한 장씩 클립보드에 복사
'                           (카톡방에서 Ctrl+V → Enter → 확인 반복)
'  기존 정산서조회 매크로(정산서 시트 H1/H2)를 그대로 재사용합니다.
' =====================================================================

Sub 정산서_이미지_일괄저장()
    Dim 일자 As Date, 저장폴더 As String, 목록 As Collection
    Dim 상호 As Variant, 대상 As Range, 성공 As Long, 실패 As String

    If Not 정산일_입력받기(일자) Then Exit Sub
    Set 목록 = 정산일_상호목록(일자)
    If 목록.Count = 0 Then MsgBox Format(일자, "yyyy-mm-dd") & " 정산 데이터가 없습니다.": Exit Sub

    저장폴더 = ThisWorkbook.Path & "\정산서이미지\" & Format(일자, "yyyymmdd")
    폴더_만들기 저장폴더

    For Each 상호 In 목록
        Set 대상 = 정산서_만들기(CStr(상호), 일자)
        If 대상 Is Nothing Then
            실패 = 실패 & vbCrLf & 상호
        ElseIf 범위_PNG저장(대상, 저장폴더 & "\" & Format(일자, "yyyymmdd") & "_" & 파일명정리(CStr(상호)) & ".png") Then
            성공 = 성공 + 1
        Else
            실패 = 실패 & vbCrLf & 상호
        End If
    Next 상호

    Sheet4.Activate
    If 실패 <> "" Then
        MsgBox 성공 & "개 저장 완료" & vbCrLf & vbCrLf & "실패한 업체:" & 실패, vbExclamation
    Else
        MsgBox 성공 & "개 저장 완료" & vbCrLf & 저장폴더, vbInformation
    End If
    Shell "explorer.exe """ & 저장폴더 & """", vbNormalFocus
End Sub

Sub 정산서_순차복사()
    Dim 일자 As Date, 목록 As Collection, 상호 As Variant
    Dim 대상 As Range, 순번 As Long, 답 As VbMsgBoxResult
    Dim 시작상호 As String, 시작함 As Boolean

    If Not 정산일_입력받기(일자) Then Exit Sub
    Set 목록 = 정산일_상호목록(일자)
    If 목록.Count = 0 Then MsgBox Format(일자, "yyyy-mm-dd") & " 정산 데이터가 없습니다.": Exit Sub

    시작상호 = Trim(InputBox("어느 업체부터 시작할까요?" & vbCrLf & "(비워두면 첫 업체 [" & 목록(1) & "]부터 시작)", "시작 업체"))
    시작함 = (시작상호 = "")

    For Each 상호 In 목록
        순번 = 순번 + 1
        If Not 시작함 Then
            If CStr(상호) = 시작상호 Then 시작함 = True Else GoTo 다음업체
        End If
        Set 대상 = 정산서_만들기(CStr(상호), 일자)
        If 대상 Is Nothing Then
            답 = MsgBox("[" & 상호 & "] 정산서를 만들지 못했습니다. 계속할까요?", vbExclamation + vbOKCancel)
        ElseIf Not 그림복사(대상) Then
            답 = MsgBox("[" & 상호 & "] 복사에 실패했습니다. 계속할까요?", vbExclamation + vbOKCancel)
        Else
            답 = MsgBox("(" & 순번 & "/" & 목록.Count & ")  [" & 상호 & "] 정산서가 복사되었습니다." & vbCrLf & vbCrLf & _
                       "카톡방에서 Ctrl+V → Enter 후 [확인]을 누르면 다음 업체로 넘어갑니다." & vbCrLf & _
                       "[취소]를 누르면 중단합니다.", vbInformation + vbOKCancel, "정산서 순차복사")
        End If
        If 답 = vbCancel Then Exit For
다음업체:
    Next 상호

    If Not 시작함 Then MsgBox "[" & 시작상호 & "] 은(는) 해당 정산일 목록에 없습니다.", vbExclamation
    Sheet4.Activate
End Sub

' ---------------------------------------------------------------------
' 내부 함수
' ---------------------------------------------------------------------

Private Function 정산일_입력받기(ByRef 일자 As Date) As Boolean
    Dim 기본값 As String, 입력 As String
    If IsDate(Sheet4.Range("H2").Value) Then 기본값 = Format(Sheet4.Range("H2").Value, "yyyy-mm-dd") Else 기본값 = Format(Date, "yyyy-mm-dd")
    입력 = InputBox("정산일을 입력하세요 (예: 2026-10-08)", "정산일", 기본값)
    If 입력 = "" Then Exit Function
    If Not IsDate(입력) Then MsgBox "날짜 형식이 올바르지 않습니다.": Exit Function
    일자 = CDate(입력)
    정산일_입력받기 = True
End Function

' 정산서DB(Sheet3)에서 해당 정산일의 상호 목록(중복 제거, 입력 순서 유지)
Private Function 정산일_상호목록(일자 As Date) As Collection
    Dim 목록 As New Collection, Dic As Object, i As Long, Last As Long, 상호 As String
    Set Dic = CreateObject("Scripting.Dictionary")
    With Sheet3
        Last = .Cells(.Rows.Count, 1).End(xlUp).Row
        For i = 2 To Last
            If IsDate(.Cells(i, 4).Value) Then
                If CLng(CDate(.Cells(i, 4).Value)) = CLng(일자) Then
                    상호 = CStr(.Cells(i, 1).Value)
                    If 상호 <> "" And Not Dic.exists(상호) Then
                        Dic.Add 상호, 1
                        목록.Add 상호
                    End If
                End If
            End If
        Next i
    End With
    Set 정산일_상호목록 = 목록
End Function

' 기존 정산서조회 매크로로 정산서_결과 시트를 만들고 캡처할 범위를 돌려줌
Private Function 정산서_만들기(상호 As String, 일자 As Date) As Range
    Dim Sh As Worksheet, 시작 As Range, 끝 As Range, 끝행 As Long

    Application.EnableEvents = False
    Sheet4.Activate
    Sheet4.Range("H1").Value = 상호
    Sheet4.Range("H2").Value = 일자
    Application.EnableEvents = True

    정산서조회.정산서조회

    On Error Resume Next
    Set Sh = ThisWorkbook.Sheets("정산서_결과")
    On Error GoTo 0
    If Sh Is Nothing Then Exit Function
    If CStr(Sh.Range("D3").Value) <> 상호 Then Exit Function

    ' 상호 칸 기준으로 B열~I열, "*보조설명" 위까지 캡처
    Set 시작 = Sh.Cells.Find(What:="상호(입금자명)", LookIn:=xlValues, LookAt:=xlWhole)
    Set 끝 = Sh.Cells.Find(What:="~*보조설명", LookIn:=xlValues, LookAt:=xlWhole)
    If 시작 Is Nothing Then Exit Function
    If 끝 Is Nothing Then 끝행 = Sh.UsedRange.Row + Sh.UsedRange.Rows.Count - 1 Else 끝행 = 끝.Row - 2

    Set 정산서_만들기 = Sh.Range(Sh.Cells(시작.Row - 1, 2), Sh.Cells(끝행, 9))
End Function

Private Function 그림복사(rng As Range) As Boolean
    Dim 시도 As Long
    For 시도 = 1 To 5
        On Error Resume Next
        Err.Clear
        rng.CopyPicture Appearance:=xlScreen, Format:=xlPicture
        If Err.Number = 0 Then 그림복사 = True: Exit Function
        On Error GoTo 0
        DoEvents
        Application.Wait Now + TimeSerial(0, 0, 1)
    Next 시도
End Function

Private Function 범위_PNG저장(rng As Range, 경로 As String) As Boolean
    Dim co As ChartObject
    If Not 그림복사(rng) Then Exit Function

    rng.Worksheet.Activate
    Set co = rng.Worksheet.ChartObjects.Add(0, 0, rng.Width, rng.Height)
    co.Activate
    With co.Chart
        .ChartArea.Format.Line.Visible = msoFalse
        .Paste
        DoEvents
        .Export Filename:=경로, FilterName:="PNG"
    End With
    co.Delete
    범위_PNG저장 = (Dir(경로) <> "")
End Function

Private Sub 폴더_만들기(경로 As String)
    Dim 부분() As String, 현재 As String, i As Long
    부분 = Split(경로, "\")
    현재 = 부분(0)
    For i = 1 To UBound(부분)
        현재 = 현재 & "\" & 부분(i)
        If Dir(현재, vbDirectory) = "" Then MkDir 현재
    Next i
End Sub

Private Function 파일명정리(s As String) As String
    Dim 금지 As Variant, c As Variant
    금지 = Array("\", "/", ":", "*", "?", """", "<", ">", "|")
    For Each c In 금지
        s = Replace(s, c, "_")
    Next c
    파일명정리 = s
End Function
